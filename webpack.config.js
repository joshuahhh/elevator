const { resolve } = require('path');
const webpack = require("webpack");
const _ = require('lodash');
const SpeedMeasurePlugin = require("speed-measure-webpack-plugin");
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");


const PROD = process.env.NODE_ENV === 'production';

module.exports = {
    mode: process.env.NODE_ENV,
    entry: _.compact([ './src/main.ts', !PROD && 'webpack-hot-middleware/client?reload=true' ]),
    output: {
        filename: 'js/app.js',
        path: resolve(__dirname, 'public'),
    },
    devtool: PROD ? 'source-map' : 'eval-cheap-source-map',
    resolve: {
        extensions: [".ts", ".js", ".json"],
    },
    module: {
        rules: [
            {
                test: /\.(ts|tsx)?$/,
                loader: 'ts-loader',
                options: { transpileOnly: true },
                exclude: '/node_modules/',
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader'],
            },
            {
                test: /\.(png|jpe?g|gif|svg|eot|ttf|woff|woff2)$/i,
                loader: 'url-loader',
            },
        ]
    },
    plugins: _.compact([
        new SpeedMeasurePlugin(),
        new ForkTsCheckerWebpackPlugin({ typescript: { configFile: 'src/tsconfig.json' } }),
        !PROD && new webpack.HotModuleReplacementPlugin(),
        // !PROD && new (require('webpack-bundle-analyzer').BundleAnalyzerPlugin)(),
    ])
};