# -*- coding: utf-8 -*-
import pandas as pd
import numpy as np
import statsmodels.api as sm
import matplotlib.pyplot as plt
from datetime import datetime
import sys

def 保存结果到文件(文件名, 内容):
    """将结果同时输出到控制台和文件"""
    print(内容)
    with open(文件名, 'a', encoding='utf-8') as f:
        f.write(内容 + "\n")

def 生成报告头():
    """生成标准化的报告头部"""
    时间戳 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    报告头 = f"""
{'=' * 60}
{'面板数据分析报告'.center(50)}
{'=' * 60}
生成时间: {时间戳}
"""
    return 报告头

def 格式表格(数据, 表头):
    """生成对齐的文本表格"""
    # 计算每列最大宽度
    col_widths = [
        max(len(str(row[i])) for row in [表头] + 数据)
        for i in range(len(表头))
    ]

    # 构建表格线
    separator = "+" + "+".join(["-" * (w + 2) for w in col_widths]) + "+"

    # 构建表头
    table = [separator]
    table.append(
        "|" + "|".join(
            [f" {h.center(w)} " for h, w in zip(表头, col_widths)]
        ) + "|"
    )
    table.append(separator)

    # 添加数据行
    for row in 数据:
        table.append(
            "|" + "|".join(
                [f" {str(cell).ljust(w)} " for cell, w in zip(row, col_widths)]
            ) + "|"
        )
    table.append(separator)
    return "\n".join(table)

# 主分析函数
def 执行分析(文件路径):
    try:
        # 初始化报告文件
        with open('分析报告.txt', 'w', encoding='utf-8') as f:
            f.write(生成报告头())

        # 1. 数据加载
        保存结果到文件('分析报告.txt', "\n[1] 数据加载".ljust(60, '-'))
        data = pd.read_excel(文件路径)
        保存结果到文件('分析报告.txt', f"✓ 成功加载数据: {data.shape[0]}行×{data.shape[1]}列")

        # 2. 数据预处理
        保存结果到文件('分析报告.txt', "\n[2] 数据预处理".ljust(60, '-'))

        # 中文列名转换
        data = data.rename(columns={
            'GDP增长率(%)': 'GDP增长率',
            'POI密度': 'POI密度',
            '人口密度': '人口密度',
            '地铁站点数': '地铁站点数',
            '政策支持': '政策支持',
            '资金支持': '资金支持'  # 新增资金支持列
        })

        # 处理时间索引
        data['时间ID'] = data.groupby('区名').cumcount() + 1
        data['组ID'] = data['区名'] + "|" + data['产业类型']
        data = data.set_index(['时间ID', '组ID'])
        保存结果到文件('分析报告.txt', "✓ 已创建新的时间ID和组ID索引")

        # 3. 模型拟合
        保存结果到文件('分析报告.txt', "\n[3] 模型拟合".ljust(60, '-'))
        exog = sm.add_constant(data[['POI密度', '人口密度', '地铁站点数', '政策支持', '资金支持']])
        model = sm.OLS(data['GDP增长率'], exog)
        results = model.fit(cov_type='cluster', cov_kwds={'groups': data.index.get_level_values(1)})
        保存结果到文件('分析报告.txt', "✓ 模型拟合完成 (OLS+聚类标准误)")
        保存结果到文件('分析报告.txt', "✓ 已包含资金支持变量分析")

        # 4. 结果展示
        保存结果到文件('分析报告.txt', "\n[4] 分析结果".ljust(60, '='))

        # 模型基本信息
        基本信息 = [
            ["模型类型", "OLS+聚类标准误"],
            ["因变量", "GDP增长率"],
            ["观测值", results.nobs],
            ["R²", f"{results.rsquared:.4f}"],
            ["调整R²", f"{results.rsquared_adj:.4f}"],
            ["F统计量", f"{results.fvalue:.2f} (p={results.f_pvalue:.4f})"]
        ]
        保存结果到文件('分析报告.txt', 格式表格(基本信息, ["项目", "值"]))

        # 参数估计结果
        参数结果 = []
        for 变量, 系数 in results.params.items():
            变量名 = {
                'const': '常数项',
                'POI密度': 'POI密度',
                '人口密度': '人口密度',
                '地铁站点数': '地铁站点数',
                '政策支持': '政策支持',
                '资金支持': '资金支持'  # 新增资金支持变量名映射
            }.get(变量, 变量)

            # 添加显著性标记
            p = results.pvalues[变量]
            sig = ('***' if p < 0.01 else
                   '**' if p < 0.05 else
                   '*' if p < 0.1 else '')

            参数结果.append([
                变量名,
                f"{系数:.4f}{sig}",
                f"{results.bse[变量]:.4f}",
                f"{results.tvalues[变量]:.2f}",
                f"{results.pvalues[变量]:.4f}"
            ])

        保存结果到文件('分析报告.txt', "\n参数估计结果:")
        保存结果到文件('分析报告.txt', 格式表格(参数结果, ["变量", "系数", "标准误", "t值", "P值"]))
        保存结果到文件('分析报告.txt', "\n注：*** p<0.01, ** p<0.05, * p<0.1")

        # 5. 可视化
        plt.rcParams['font.sans-serif'] = ['SimHei']

        # 原变量关系图
        fig, axs = plt.subplots(2, 2, figsize=(12, 10))
        for ax, var in zip(axs.flat, ['POI密度', '人口密度', '地铁站点数', '政策支持']):
            ax.scatter(data[var], data['GDP增长率'], alpha=0.6)
            ax.set_xlabel(var)
            ax.set_ylabel('GDP增长率(%)')
        plt.tight_layout()
        plt.savefig('变量关系图.png', dpi=300)
        保存结果到文件('分析报告.txt', "\n✓ 基础变量关系图已保存为: 变量关系图.png")

        # 资金支持专项分析图
        plt.figure(figsize=(10, 6))
        plt.scatter(data['资金支持'], data['GDP增长率'], alpha=0.7, color='green')

        # 添加回归线
        coef = results.params['资金支持']
        intercept = results.params['const']
        x = np.linspace(data['资金支持'].min(), data['资金支持'].max(), 100)
        plt.plot(x, intercept + coef * x, 'r--',
                 label=f'回归线: y={intercept:.2f}+{coef:.2f}x')

        plt.xlabel('资金支持力度')
        plt.ylabel('GDP增长率(%)')
        plt.title('资金支持与GDP增长率关系')
        plt.legend()
        plt.savefig('资金支持效果图.png', dpi=300, bbox_inches='tight')
        保存结果到文件('分析报告.txt', "✓ 资金支持专项分析图已保存为: 资金支持效果图.png")

        return True

    except Exception as e:
        错误信息 = f"\n!!! 分析中断: {str(e)}\n建议检查:\n1. 资金支持列是否存在\n2. 数据格式是否正确\n3. 变量是否存在缺失值"
        保存结果到文件('分析报告.txt', 错误信息)
        return False


if __name__ == "__main__":
    文件路径 = "D:\\HuaweiMoveData\\Users\\92802\\Desktop\\经济地理学\\面板数据模型.xlsx"
    if 执行分析(文件路径):
        print(f"\n{'分析完成!'.center(40, '=')}")
        print("结果已保存到:")
        print("- 分析报告.txt")
        print("- 变量关系图.png")
        print("- 资金支持效果图.png")
    else:
        print("分析失败，请检查错误信息")